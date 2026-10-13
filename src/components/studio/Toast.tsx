'use client';
/**
 * In-house toast system: <ToastProvider> + useToast().
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';
import { cx } from './hooks';

export type ToastKind = 'info' | 'success' | 'error';
export interface ToastInput {
  title: string;
  description?: string;
  kind?: ToastKind;
  /** ms; 0 = sticky until dismissed */
  durationMs?: number;
  action?: { label: string; onClick: () => void };
}
interface ToastItem extends ToastInput { id: number }
interface ToastContextValue {
  toast: (t: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { window.clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const toast = useCallback((t: ToastInput) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-3), { ...t, id }]);
    const duration = t.durationMs ?? (t.kind === 'error' ? 7000 : 4200);
    if (duration > 0) {
      const timer = window.setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    }
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+72px)] lg:bottom-6 z-[100] flex flex-col items-center gap-2 px-4">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
              className="pointer-events-auto panel-strong flex w-full max-w-md items-start gap-3 px-4 py-3 shadow-[var(--shadow-lg)]"
              role="status"
            >
              <span className={cx('mt-0.5 shrink-0', t.kind === 'success' ? 'text-success' : t.kind === 'error' ? 'text-danger' : 'text-brass')}>
                {t.kind === 'success' ? <CircleCheck size={16} /> : t.kind === 'error' ? <CircleX size={16} /> : <Info size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-tight text-ink">{t.title}</div>
                {t.description && <div className="mt-0.5 text-[12px] leading-snug text-muted">{t.description}</div>}
              </div>
              {t.action && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary shrink-0"
                  onClick={() => { t.action?.onClick(); dismiss(t.id); }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" aria-label="Dismiss" className="shrink-0 rounded-md p-1 text-dim hover:bg-white/5 hover:text-ink" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
