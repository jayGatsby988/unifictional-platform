'use client';
/**
 * Drag-and-drop multi-photo uploader with thumbnails, reorder, primary
 * marking and removal. Files stay local until the analysis pipeline uploads
 * downscaled copies.
 */
import { useCallback, useRef, useState, type DragEvent, type ChangeEvent } from 'react';
import { ChevronLeft, ChevronRight, GripVertical, ImagePlus, Star, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { ACCEPT_ATTR, fmtBytes, isAcceptedImage, isHeic } from './imageUtils';
import { cx } from './hooks';

export interface UploadItem {
  id: string;
  file: File;
  /** object URL for the local preview */
  url: string;
  primary: boolean;
  heic: boolean;
}

export function createUploadItems(files: File[]): UploadItem[] {
  return files.map((file) => ({ id: nanoid(8), file, url: URL.createObjectURL(file), primary: false, heic: isHeic(file) }));
}

export function revokeUploadItems(items: UploadItem[]) {
  for (const it of items) {
    try { URL.revokeObjectURL(it.url); } catch { /* ignore */ }
  }
}

function normalizePrimary(items: UploadItem[]): UploadItem[] {
  if (!items.length) return items;
  const idx = items.findIndex((i) => i.primary);
  const primaryIdx = idx === -1 ? 0 : idx;
  return items.map((i, n) => ({ ...i, primary: n === primaryIdx }));
}

function Thumb({ item, index, count, onPrimary, onRemove, onMove, onDragStart, onDragOverItem, onDropItem, dragging, disabled }: {
  item: UploadItem; index: number; count: number;
  onPrimary: () => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
  onDragStart: () => void; onDragOverItem: (e: DragEvent) => void; onDropItem: () => void;
  dragging: boolean; disabled?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      draggable={!disabled}
      onDragStart={onDragStart}
      onDragOver={onDragOverItem}
      onDrop={(e) => { e.preventDefault(); onDropItem(); }}
      className={cx(
        'group relative aspect-[4/3] overflow-hidden rounded-[var(--radius-sm)] border bg-surface-2 transition-all',
        item.primary ? 'border-brass shadow-[0_0_0_3px_var(--brass-soft)]' : 'border-border hover:border-border-strong',
        dragging && 'opacity-40',
      )}
    >
      {broken || item.heic ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-center">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted">{item.heic ? 'HEIC' : 'Photo'}</span>
          <span className="px-3 text-[11px] text-dim">{item.heic ? 'Preview unavailable in this browser — uploads fine' : 'Preview unavailable'}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={item.file.name} className="h-full w-full object-cover" onError={() => setBroken(true)} draggable={false} />
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/70 to-transparent p-2">
        <span className="truncate text-[11px] text-white/85">{index + 1} · {fmtBytes(item.file.size)}</span>
        {item.primary && <span className="chip chip-brass h-5 px-1.5 text-[10px]">Primary</span>}
      </div>
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <div className="flex items-center gap-1">
          <button type="button" title="Drag to reorder" className="grid h-7 w-7 cursor-grab place-items-center rounded-md bg-black/55 text-white/80 backdrop-blur"><GripVertical size={14} /></button>
          <button type="button" title="Move earlier" disabled={index === 0 || disabled} onClick={() => onMove(-1)} className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white/80 backdrop-blur hover:bg-black/75 disabled:opacity-30"><ChevronLeft size={14} /></button>
          <button type="button" title="Move later" disabled={index === count - 1 || disabled} onClick={() => onMove(1)} className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white/80 backdrop-blur hover:bg-black/75 disabled:opacity-30"><ChevronRight size={14} /></button>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title={item.primary ? 'Primary photo' : 'Mark as primary'} disabled={disabled} onClick={onPrimary} className={cx('grid h-7 w-7 place-items-center rounded-md backdrop-blur hover:bg-black/75', item.primary ? 'bg-brass text-[#0a0a0a]' : 'bg-black/55 text-white/80')}>
            <Star size={14} fill={item.primary ? 'currentColor' : 'none'} />
          </button>
          <button type="button" title="Remove" disabled={disabled} onClick={onRemove} className="grid h-7 w-7 place-items-center rounded-md bg-black/55 text-white/80 backdrop-blur hover:bg-danger/80 hover:text-white"><X size={14} /></button>
        </div>
      </div>
    </div>
  );
}

export function PhotoUploader({ items, onChange, onReject, max = 12, disabled, hint }: {
  items: UploadItem[];
  onChange: (items: UploadItem[]) => void;
  onReject?: (messages: string[]) => void;
  max?: number;
  disabled?: boolean;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files);
    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const f of incoming) {
      if (!isAcceptedImage(f)) { rejected.push(`${f.name}: not a supported image (JPG, PNG, WebP or HEIC)`); continue; }
      if (f.size > 40 * 1024 * 1024) { rejected.push(`${f.name}: larger than 40 MB`); continue; }
      accepted.push(f);
    }
    const room = Math.max(0, max - items.length);
    if (accepted.length > room) {
      rejected.push(`Only ${max} photos per project — ${accepted.length - room} skipped`);
      accepted.splice(room);
    }
    if (rejected.length) onReject?.(rejected);
    if (accepted.length) onChange(normalizePrimary([...items, ...createUploadItems(accepted)]));
  }, [items, max, onChange, onReject]);

  const onInput = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = '';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    if (dragIdx !== null) { setDragIdx(null); return; }
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const move = (from: number, to: number) => {
    if (from === to || to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };

  const remove = (id: string) => {
    const it = items.find((i) => i.id === id);
    if (it) { try { URL.revokeObjectURL(it.url); } catch { /* ignore */ } }
    onChange(normalizePrimary(items.filter((i) => i.id !== id)));
  };

  const setPrimary = (id: string) => onChange(items.map((i) => ({ ...i, primary: i.id === id })));

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="Add photos"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); if (dragIdx === null) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx(
          'relative cursor-pointer rounded-[var(--radius)] border border-dashed p-5 transition-colors',
          over ? 'border-brass bg-brass-soft' : 'border-border-strong bg-white/[0.02] hover:bg-white/[0.04]',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <input ref={inputRef} type="file" accept={ACCEPT_ATTR} multiple hidden onChange={onInput} />
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full border border-border bg-surface-2 text-brass"><ImagePlus size={20} /></span>
            <div className="text-[15px] text-ink">Drop photos here, or <span className="text-brass underline-offset-2 hover:underline">browse</span></div>
            <div className="max-w-sm text-[12.5px] text-muted">{hint ?? 'Wide shots from the doorway work best. Add a few angles for a better twin.'}</div>
            <div className="mt-1 font-mono text-[10.5px] uppercase tracking-widest text-dim">JPG · PNG · WebP · HEIC · up to {max} photos · downscaled to 2048px before upload</div>
          </div>
        ) : (
          <div onClick={(e) => e.stopPropagation()} className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {items.map((it, i) => (
              <Thumb
                key={it.id}
                item={it}
                index={i}
                count={items.length}
                disabled={disabled}
                dragging={dragIdx === i}
                onPrimary={() => setPrimary(it.id)}
                onRemove={() => remove(it.id)}
                onMove={(dir) => move(i, i + dir)}
                onDragStart={() => setDragIdx(i)}
                onDragOverItem={(e) => { e.preventDefault(); }}
                onDropItem={() => { if (dragIdx !== null) move(dragIdx, i); setDragIdx(null); }}
              />
            ))}
            {items.length < max && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-[var(--radius-sm)] border border-dashed border-border-strong text-muted transition-colors hover:border-brass hover:text-brass"
              >
                <ImagePlus size={18} />
                <span className="text-[12px]">Add more</span>
              </button>
            )}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted">
          <span>{items.length} photo{items.length === 1 ? '' : 's'} · star one as the primary view (it drives the camera match and photoreal renders)</span>
          <button type="button" className="text-dim hover:text-ink" onClick={() => { revokeUploadItems(items); onChange([]); }}>Clear all</button>
        </div>
      )}
    </div>
  );
}
