'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, Bot, Check, ChevronRight, FileText, LoaderCircle, LockKeyhole, Sparkles, Square, TriangleAlert, Undo2 } from 'lucide-react';
import { designFingerprint, snapshotOf, type JarvisActivity, type JarvisConstraints } from '@/lib/jarvis/types';
import { assertSnapshotFresh } from '@/lib/jarvis/project';
import { useProjectStore } from '@/lib/store/project-store';
import { fmtRange, fmtUSD } from '@/lib/units';
import { cx, errorMessage } from './hooks';
import { slotLabel } from './projectUtils';
import { JarvisBudgetLabel, JarvisOptionCard, jarvisArtifactUrl, jarvisOptionBlocked, jarvisOptionUnpriced } from './JarvisOptionCard';
import { JarvisMessageText } from './JarvisMessageText';
import { useJarvis } from './useJarvis';

const EXAMPLES = [
  { label: 'Work within $85k', text: 'Keep the high end of the remodel estimate within $85,000, and retain my existing appliances.' },
  { label: 'Try white oak', text: 'Show me a design with white oak cabinets that works with this room.' },
  { label: 'An 8 ft island', text: 'Make the island 8 feet long if it fits with proper walkways. Explain any constraints.' },
  { label: 'Compare 3 options', text: 'Create three distinct design options for this room, with real estimates and a comparison.' },
];

function ActivityList({ activities }: { activities: JarvisActivity[] }) {
  return <ol className="space-y-2">{activities.map((a) => <li key={a.id} className="flex items-start gap-2 text-[11px] leading-relaxed">
    {a.status === 'running' ? <LoaderCircle size={12} className="mt-0.5 shrink-0 animate-spin text-brass motion-reduce:animate-none" /> : a.status === 'failed' ? <TriangleAlert size={12} className="mt-0.5 shrink-0 text-danger" /> : <Check size={12} className="mt-0.5 shrink-0 text-success" />}
    <div className="min-w-0 flex-1 break-words"><span className={a.status === 'failed' ? 'text-danger' : 'text-muted'}>{a.label}</span>{a.detail && <p className="mt-0.5 text-dim">{a.detail}</p>}</div>
    <span className="shrink-0 text-[10px] text-dim">{a.status === 'running' ? 'Working' : a.status === 'failed' ? 'Failed' : 'Done'}</span>
  </li>)}</ol>;
}

function Constraints({ value, disabled, onSend, onError }: { value: JarvisConstraints; disabled: boolean; onSend: (text: string) => void; onError: (text: string) => void }) {
  const id = useId();
  const submitBudget = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = String(new FormData(e.currentTarget).get('budget') ?? '').replace(/[$,\s]/g, '');
    if (!text) { onSend('Remove my hard budget limit.'); return; }
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) { onError('Enter a budget greater than zero, or leave it blank to remove the limit.'); return; }
    onSend(`Set my hard budget to ${fmtUSD(amount)}. The high end of every option's estimated range must fit this limit.`);
  };
  return <details className="rounded-xl border border-border bg-surface/35">
    <summary className="cursor-pointer px-3 py-2.5 text-[11px] text-muted"><span className="ml-1">Project constraints</span><span className="ml-2 text-brass">{value.budgetMax === null ? 'No budget set' : `${fmtUSD(value.budgetMax)} max`}</span></summary>
    <div className="space-y-3 px-3 pb-3">
      <form onSubmit={submitBudget}>
        <label htmlFor={id} className="mb-1.5 block text-[11px] text-muted">Maximum budget · USD</label>
        <div className="flex gap-2"><input key={value.budgetMax ?? 'unset'} id={id} name="budget" type="text" inputMode="decimal" defaultValue={value.budgetMax ?? ''} placeholder="e.g. 85,000" disabled={disabled} className="input num min-w-0 flex-1" /><button type="submit" className="btn !px-3" disabled={disabled}>Update</button></div>
        <p className="mt-1 text-[10px] leading-relaxed text-dim">Jarvis checks the high end of the estimate. Blank removes the limit.</p>
      </form>
      <label className="flex min-h-9 cursor-pointer items-center gap-2 text-[12px] text-muted"><input type="checkbox" checked={value.keepAppliances} disabled={disabled} onChange={(e) => onSend(e.target.checked ? 'Retain my existing appliances in all design options.' : 'You may suggest replacing the appliances in new design options.')} className="h-4 w-4 accent-[var(--brass)]" />Retain existing appliances</label>
      {value.lockedSlots.length > 0 && <div className="flex flex-wrap gap-1.5">{value.lockedSlots.map((slot) => <span key={slot} className="chip text-[10px]"><LockKeyhole size={10} />{slotLabel(slot)}</span>)}</div>}
    </div>
  </details>;
}

/** Mounted once by StudioShell; switching tabs never interrupts a job. */
export function JarvisPanel({ active = true }: { active?: boolean }) {
  const { state, busy, status, activity, error, send, cancel, applyOption, renderOption, generateProposal, removeOption, undo } = useJarvis();
  const project = useProjectStore((s) => s.project);
  const { spec, selections, renders, id: projectId } = project;
  const [draftState, setDraftState] = useState({ projectId, text: '' });
  const draft = draftState.projectId === projectId ? draftState.text : '';
  const setDraft = (text: string) => setDraftState({ projectId, text });
  const [localError, setLocalError] = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<{ projectId: string; ids: string[] } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);
  const composerId = useId();
  const currentSnapshot = useMemo(() => spec ? snapshotOf(project) : null, [project, spec]);
  const currentFingerprint = useMemo(() => currentSnapshot ? designFingerprint(currentSnapshot) : null, [currentSnapshot]);
  const staleReasons = useMemo<Record<string, string>>(() => {
    if (!currentSnapshot) return {};
    const reasons: Record<string, string> = {};
    for (const option of state.options) {
      try { assertSnapshotFresh(currentSnapshot, option.snapshot); }
      catch (cause) { reasons[option.id] = errorMessage(cause, 'This option is out of date. Ask Jarvis to rebuild it using the current project.'); }
    }
    return reasons;
  }, [currentSnapshot, state.options]);
  const activeOptionId = useMemo(() => state.options.find((o) => o.id === state.activeOptionId && designFingerprint(o.snapshot) === currentFingerprint)?.id ?? null, [state.options, state.activeOptionId, currentFingerprint]);
  const undoAvailable = !!state.undo && state.undo.afterFingerprint === currentFingerprint;
  const selected = compareIds?.projectId === projectId ? compareIds.ids.filter((id) => !staleReasons[id] && state.options.some((o) => o.id === id)) : state.options.filter((o) => !staleReasons[o.id] && !jarvisOptionBlocked(o)).map((o) => o.id);
  const optionsToCompare = state.options.filter((o) => selected.includes(o.id));
  const canPropose = optionsToCompare.length > 0 && optionsToCompare.every((o) => !jarvisOptionBlocked(o) && !jarvisOptionUnpriced(o).length);

  useEffect(() => {
    if (!active || !pinned.current) return;
    const frame = requestAnimationFrame(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(frame);
  }, [state.messages, state.options, state.proposals, activity, active]);

  const run = async (action: () => Promise<void> | void) => {
    setLocalError(null);
    try { await action(); } catch (cause) { setLocalError(errorMessage(cause, 'That action could not be completed. Please try again.')); }
  };
  const submit = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !spec) return;
    pinned.current = true;
    setAtBottom(true);
    const before = useProjectStore.getState().project.jarvis?.messages.at(-1)?.id;
    setLocalError(null);
    try { await send(message); } catch (cause) {
      setLocalError(errorMessage(cause, 'Your message could not be completed. Please try again.'));
    }
    const latest = useProjectStore.getState().project;
    // The hook reports errors inline and rolls back incomplete turns. Restore
    // an unsaved request for retry without overwriting the next draft.
    if (latest.id === projectId && latest.jarvis?.messages.at(-1)?.id === before) {
      setDraftState((current) => current.projectId === projectId && !current.text ? { projectId, text: message } : current);
    }
  };
  const sendDraft = () => {
    if (!draft.trim() || busy || !spec) return;
    const message = draft;
    setDraft('');
    void submit(message);
  };
  const chooseExample = (text: string) => { setDraft(text); composer.current?.focus(); };
  const toggleCompare = (id: string) => setCompareIds({ projectId, ids: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id] });
  const failure = localError || error;

  return <section aria-label="Jarvis design assistant" className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-4 py-3">
      <div className="grid h-9 w-9 place-items-center rounded-xl border border-brass/25 bg-brass-soft text-brass"><Bot size={18} /></div>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-display text-[22px] leading-none">Jarvis</h2><span className="rounded-full border border-brass/25 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-brass">Astra</span></div><p className="mt-1 text-[10.5px] text-dim">Design, price, and compare your project.</p></div>
      {state.undo && <button type="button" className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-40" title={undoAvailable ? 'Undo the last Jarvis design change' : 'Undo paused to preserve your subsequent edits'} aria-label={undoAvailable ? 'Undo last Jarvis design change' : 'Undo paused to preserve your subsequent edits'} disabled={busy || !undoAvailable} onClick={() => void run(undo)}><Undo2 size={16} /></button>}
    </header>
    <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" onScroll={(e) => { const el = e.currentTarget; const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80; pinned.current = bottom; setAtBottom(bottom); }}>
      <Constraints value={state.constraints} disabled={busy || !spec} onSend={(text) => void submit(text)} onError={setLocalError} />
      {!state.messages.length && <div className="py-6">
        <Sparkles size={20} className="mb-3 text-brass" />
        <h3 className="max-w-[250px] font-display text-[26px] leading-tight">What would you like to change?</h3>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{spec ? 'Describe the result you want. Jarvis works with your 3D model, materials, and estimate.' : 'Build a 3D model first, then explore designs and costs with Jarvis.'}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">{EXAMPLES.map((example) => <button key={example.label} type="button" disabled={!spec || busy} onClick={() => chooseExample(example.text)} className="flex min-h-12 items-center justify-between gap-1 rounded-lg border border-border bg-surface/40 px-2.5 py-2 text-left text-[11px] leading-snug text-muted transition-colors hover:border-brass/50 hover:text-ink disabled:opacity-40"><span>{example.label}</span><ChevronRight size={12} className="shrink-0 text-dim" /></button>)}</div>
      </div>}
      <div role="log" aria-label="Conversation with Jarvis" aria-live="polite" aria-relevant="additions text" className="mt-4 space-y-5">{state.messages.map((message) => <div key={message.id} className={cx('min-w-0', message.role === 'user' && 'ml-5 rounded-xl rounded-br-sm border border-border bg-surface-2/70 px-3 py-2.5')}>
        <div className={cx('mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em]', message.role === 'assistant' ? 'text-brass' : 'text-dim')}>{message.role === 'assistant' ? 'Jarvis' : 'You'}</div>
        <JarvisMessageText role={message.role} text={message.text} />
        {!!message.activities?.length && <details className="mt-2 rounded-lg border border-border px-2.5 py-2"><summary className="cursor-pointer text-[10px] text-dim">{message.activities.length} project action{message.activities.length === 1 ? '' : 's'}</summary><div className="mt-2"><ActivityList activities={message.activities} /></div></details>}
      </div>)}</div>
      {(busy || activity.some((a) => a.status === 'failed')) && <div className="mt-4 rounded-xl border border-brass/20 bg-brass-soft/25 p-3" role="status" aria-live="polite"><div className="mb-2 flex items-center gap-2 text-[11px] text-brass">{busy && <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />}<span>{status || (busy ? 'Working on your project…' : 'Project activity')}</span></div><ActivityList activities={activity} /></div>}
      {state.options.length > 0 && spec && <section className="mt-6" aria-label="Design options">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-display text-[21px]">Your options</h3><span className="text-[10px] text-dim">{state.options.length} designs</span></div>
        {optionsToCompare.length > 1 && <div className="mb-3 overflow-hidden rounded-xl border border-border"><table className="w-full text-left text-[11px]"><caption className="border-b border-border bg-surface/40 px-3 py-2 text-left text-[10px] text-muted">Comparing {optionsToCompare.length} selected options</caption><thead className="sr-only"><tr><th>Option</th><th>Estimate and budget</th></tr></thead><tbody>{optionsToCompare.map((o) => <tr key={o.id} className="border-b border-border last:border-0"><th scope="row" className="max-w-[120px] break-words px-3 py-2 align-top font-normal">{o.name}{o.id === activeOptionId && <span className="mt-1 block text-[9px] text-brass">In 3D</span>}</th><td className="px-3 py-2"><div className="num">{jarvisOptionUnpriced(o).length && o.estimate.mid === 0 ? 'Pricing needed' : fmtUSD(o.estimate.mid)}</div><div className="num text-[10px] text-dim">{fmtRange(o.estimate.totalLow, o.estimate.totalHigh)}</div><JarvisBudgetLabel option={o} /></td></tr>)}</tbody></table></div>}
        <div className="space-y-3">{state.options.map((option, index) => <JarvisOptionCard key={option.id} option={option} index={index} active={activeOptionId === option.id} compared={selected.includes(option.id)} busy={busy} staleReason={staleReasons[option.id]} currentSpec={spec} currentSelections={selections} renders={renders} onCompare={() => toggleCompare(option.id)} onApply={() => void run(() => applyOption(option.id))} onRender={() => void run(() => renderOption(option.id))} onRemove={() => void run(() => removeOption(option.id))} />)}</div>
        <button type="button" className="btn mt-3 w-full !px-2" disabled={busy || !canPropose} onClick={() => void run(() => generateProposal(selected))}><FileText size={14} />Generate proposal{selected.length > 0 ? ` · ${selected.length} option${selected.length === 1 ? '' : 's'}` : ''}</button>
        {!canPropose && <p className="mt-1.5 text-[10px] text-dim">Select valid options with complete pricing within your budget to create a proposal. Unpriced scan work requires a takeoff and contractor pricing.</p>}
      </section>}
      {state.proposals.length > 0 && <section aria-label="Generated proposals" className="mt-5 space-y-2"><h3 className="eyebrow">Proposals</h3>{state.proposals.map((proposal) => { const url = jarvisArtifactUrl(proposal.url); return url ? <a key={proposal.id} href={url} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center gap-2 rounded-lg border border-border px-3 py-2 text-[12px] text-muted hover:border-brass/50 hover:text-ink"><FileText size={15} className="shrink-0 text-brass" /><span className="min-w-0 flex-1 break-words">{proposal.title}</span><ChevronRight size={14} className="shrink-0" /></a> : <p key={proposal.id} className="text-[11px] text-danger">The proposal link is unavailable. Generate it again.</p>; })}</section>}
    </div>
    {!atBottom && <button type="button" className="mx-auto mb-1 flex min-h-8 items-center gap-1 rounded-full border border-border bg-bg-elev px-3 text-[10px] text-muted" onClick={() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; pinned.current = true; setAtBottom(true); }}><ArrowDown size={11} />Latest activity</button>}
    <div className="shrink-0 border-t border-border bg-bg-elev px-3 pb-3 pt-2">
      {failure && <div className="mb-2 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11px] leading-relaxed text-danger" role="alert"><TriangleAlert size={13} className="mt-0.5 shrink-0" /><p className="min-w-0 break-words">{failure}</p></div>}
      <form onSubmit={(e) => { e.preventDefault(); sendDraft(); }} className="rounded-xl border border-border-strong bg-bg focus-within:border-brass/60">
        <label htmlFor={composerId} className="sr-only">Message Jarvis</label>
        <textarea ref={composer} id={composerId} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!spec} rows={2} maxLength={8000} placeholder={busy ? 'Plan your next request…' : 'Ask Jarvis to change your project…'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); sendDraft(); } }} className="block max-h-36 min-h-[68px] w-full resize-y rounded-xl bg-transparent px-3 pb-1 pt-2.5 text-[13px] leading-relaxed text-ink outline-none placeholder:text-dim disabled:opacity-50" />
        <div className="flex items-center justify-between gap-2 px-2 pb-2"><span className="pl-1 text-[9.5px] text-dim">Enter to send · Shift + Enter for a new line</span>{busy ? <button type="button" onClick={cancel} className="btn btn-sm !min-h-9 !px-3" aria-label="Stop Jarvis"><Square size={11} fill="currentColor" />Stop</button> : <button type="submit" disabled={!draft.trim() || !spec} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brass text-[#0a0a0a] transition-opacity disabled:opacity-30" aria-label="Send message to Jarvis"><ArrowUp size={17} /></button>}</div>
      </form>
    </div>
  </section>;
}
