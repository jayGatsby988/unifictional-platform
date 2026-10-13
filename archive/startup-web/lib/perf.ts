/**
 * Device/connection checks for the site's heaviest optional extras.
 *
 * Live embeds load entire third-party websites, so they're reserved for
 * machines and connections that can take it: a real desktop viewport, a decent
 * CPU/RAM, a fast connection and no data-saver. Everyone else sees the
 * (identical-looking) screenshots. Browsers that don't expose a signal (Safari,
 * Firefox) are judged on the signals they do expose.
 */
type Conn = { saveData?: boolean; effectiveType?: string; downlink?: number };
type Nav = Navigator & { connection?: Conn; deviceMemory?: number };

export function canRunLiveEmbeds(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.matchMedia("(min-width: 1024px)").matches) return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const nav = navigator as Nav;
  const c = nav.connection;
  if (c?.saveData) return false;
  if (c?.effectiveType && c.effectiveType !== "4g") return false;
  if (typeof c?.downlink === "number" && c.downlink > 0 && c.downlink < 5) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 8) return false;
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency < 8)
    return false;
  return true;
}

/** True on data-saver / slow connections or low-memory devices. (Core count
 *  isn't used here: iOS Safari under-reports it, which would wrongly
 *  downgrade every iPhone.) */
export function isConstrained(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Nav;
  const c = nav.connection;
  return (
    !!c?.saveData ||
    (c?.effectiveType != null && c.effectiveType !== "4g") ||
    (typeof c?.downlink === "number" && c.downlink > 0 && c.downlink < 1.5) ||
    (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2)
  );
}

/** Run `fn` once the page has fully loaded and the main thread is idle. */
export function afterLoadIdle(fn: () => void, timeout = 2500): () => void {
  let cancelled = false;
  let idle: number | undefined;
  let t: ReturnType<typeof setTimeout> | undefined;
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  const run = () => !cancelled && fn();
  const arm = () => {
    if (cancelled) return;
    if (w.requestIdleCallback) idle = w.requestIdleCallback(run, { timeout });
    else t = setTimeout(run, 800);
  };
  if (document.readyState === "complete") arm();
  else window.addEventListener("load", arm, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", arm);
    if (idle != null) w.cancelIdleCallback?.(idle);
    if (t) clearTimeout(t);
  };
}
