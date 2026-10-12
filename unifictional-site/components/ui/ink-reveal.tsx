"use client";
import { useEffect, useRef, useCallback } from "react";

interface InkRevealProps {
  /** RGB color of the mask overlay, e.g. [252, 250, 248] */
  maskColor?: [number, number, number];
  /** Radius of each ink stamp in px */
  brushSize?: number;
  /** How long each stamp lives before fading (ms) */
  lifetime?: number;
  /** Initial radius before the stamp expands */
  rStart?: number;
  /** Random variation factor for stamp radius (0–1) */
  rVary?: number;
  /** Min pixel distance between stamps along a stroke */
  stampStep?: number;
  /** Max stamps alive at once (oldest are pruned) */
  maxStamps?: number;
  /** Number of segments on the wobble circle (higher = smoother) */
  segments?: number;
  /** Wobble amplitude weights [primary, secondary, tertiary] */
  wobble?: [number, number, number];
  /** Gradient inner-radius factor (0–1, relative to stamp radius) */
  gradientInnerRadius?: number;
  /** Gradient opacity stops [center, mid, edge] */
  gradientStops?: [number, number, number];
  /**
   * Where pointer movement is read from.
   *  • "self"   — the canvas captures its own mouse events (default, original).
   *  • "window" — tracks the cursor anywhere on the page; the canvas becomes
   *    non-interactive so it can sit behind real content as a background.
   */
  eventSource?: "self" | "window";
  /** Extra CSS class for the canvas element */
  className?: string;
  /** Extra inline styles for the canvas element */
  style?: React.CSSProperties;
}

interface Stamp {
  x: number;
  y: number;
  born: number;
  seed: number;
  rmax: number;
}

export default function InkReveal({
  maskColor = [252, 250, 248],
  brushSize = 128,
  lifetime = 600,
  rStart = 10,
  rVary = 0.45,
  stampStep = 10,
  maxStamps = 200,
  segments = 36,
  wobble = [0.14, 0.08, 0.05],
  gradientInnerRadius = 0.2,
  gradientStops = [0.95, 0.88, 0],
  eventSource = "self",
  className,
  style,
}: InkRevealProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stampsRef = useRef<Stamp[]>([]);
  const runningRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  /** Area repainted last frame — only this region (plus the live stamps) is
   *  redrawn each frame, instead of refilling the whole page-sized canvas. */
  const prevBoxRef = useRef<[number, number, number, number] | null>(null);

  const mc = maskColor;

  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    // A soft veil — render at 1x to keep the per-frame repaint cheap even when
    // the canvas spans a tall section.
    const dpr = 1;
    const rect = parent.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    // Mobile browsers fire resize as the URL bar slides in/out while
    // scrolling; re-allocating a page-sized canvas each time caused jank.
    if (w === dimsRef.current.w && h === dimsRef.current.h && canvas.width > 0) return;
    dimsRef.current = { w, h };
    prevBoxRef.current = null;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgb(${mc[0]},${mc[1]},${mc[2]})`;
    ctx.fillRect(0, 0, w, h);
  }, [mc]);

  const carveInk = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      x: number,
      y: number,
      r: number,
      seed: number,
      alpha: number
    ) => {
      const g = ctx.createRadialGradient(x, y, r * gradientInnerRadius, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${gradientStops[0] * alpha})`);
      g.addColorStop(0.5, `rgba(0,0,0,${gradientStops[1] * alpha})`);
      g.addColorStop(1, `rgba(0,0,0,${gradientStops[2] * alpha})`);
      ctx.fillStyle = g;

      ctx.beginPath();
      for (let i = 0; i <= segments; i++) {
        const a = (i / segments) * Math.PI * 2;
        const wob =
          0.78 +
          wobble[0] * Math.sin(a * 3 + seed) +
          wobble[1] * Math.sin(a * 5 + seed * 2.1) +
          wobble[2] * Math.sin(a * 7 + seed * 0.7);
        const px = x + Math.cos(a) * r * wob;
        const py = y + Math.sin(a) * r * wob;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    },
    [segments, wobble, gradientInnerRadius, gradientStops]
  );

  const addStamp = useCallback(
    (x: number, y: number) => {
      const stamps = stampsRef.current;
      if (stamps.length >= maxStamps) stamps.shift();
      stamps.push({
        x,
        y,
        born: performance.now(),
        seed: Math.random() * Math.PI * 2,
        rmax: brushSize * (1 - rVary + Math.random() * rVary),
      });
    },
    [brushSize, rVary, maxStamps]
  );

  const stampAlong = useCallback(
    (x: number, y: number) => {
      const last = lastPosRef.current;
      if (!last) {
        addStamp(x, y);
      } else {
        const dx = x - last.x;
        const dy = y - last.y;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / stampStep));
        for (let i = 1; i <= steps; i++) {
          addStamp(last.x + (dx * i) / steps, last.y + (dy * i) / steps);
        }
      }
      lastPosRef.current = { x, y };
    },
    [addStamp, stampStep]
  );

  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = dimsRef.current;
    const now = performance.now();
    const stamps = stampsRef.current;

    // Work out this frame's stamps and the box they cover.
    const live: [number, number, number, number, number][] = [];
    let box: [number, number, number, number] | null = null;
    for (let i = stamps.length - 1; i >= 0; i--) {
      const t = (now - stamps[i].born) / lifetime;
      if (t >= 1) {
        stamps.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - t, 3);
      const r = rStart + (stamps[i].rmax - rStart) * ease;
      const alpha = 1 - t * t;
      live.push([stamps[i].x, stamps[i].y, r, stamps[i].seed, alpha]);
      const e = r * 1.1 + 2; // wobble peaks at ~1.05r
      const b: [number, number, number, number] = [
        stamps[i].x - e,
        stamps[i].y - e,
        stamps[i].x + e,
        stamps[i].y + e,
      ];
      box = box
        ? [Math.min(box[0], b[0]), Math.min(box[1], b[1]), Math.max(box[2], b[2]), Math.max(box[3], b[3])]
        : b;
    }

    // Restore the veil only where last frame or this frame drew — same pixels
    // as refilling the whole canvas, a fraction of the fill cost.
    const prev = prevBoxRef.current;
    const dirty = prev && box
      ? [Math.min(prev[0], box[0]), Math.min(prev[1], box[1]), Math.max(prev[2], box[2]), Math.max(prev[3], box[3])]
      : prev ?? box;
    if (dirty) {
      const x0 = Math.max(0, Math.floor(dirty[0]));
      const y0 = Math.max(0, Math.floor(dirty[1]));
      const x1 = Math.min(w, Math.ceil(dirty[2]));
      const y1 = Math.min(h, Math.ceil(dirty[3]));
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgb(${mc[0]},${mc[1]},${mc[2]})`;
      if (x1 > x0 && y1 > y0) ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    prevBoxRef.current = box;

    ctx.globalCompositeOperation = "destination-out";
    // (destination-out is order-independent, so any order gives the same veil)
    for (let i = 0; i < live.length; i++) {
      const [x, y, r, seed, alpha] = live[i];
      carveInk(ctx, x, y, r, seed, alpha);
    }

    if (stamps.length) {
      requestAnimationFrame(loop);
    } else {
      runningRef.current = false;
    }
  }, [carveInk, mc, lifetime, rStart]);

  const startLoop = useCallback(() => {
    if (!runningRef.current) {
      runningRef.current = true;
      requestAnimationFrame(loop);
    }
  }, [loop]);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  // Background mode: read the cursor from the window so the reveal works even
  // though real content sits on top of (and in front of) this canvas.
  useEffect(() => {
    if (eventSource !== "window") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      stampAlong(e.clientX - rect.left, e.clientY - rect.top);
      startLoop();
    };
    const onLeave = () => {
      lastPosRef.current = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerout", onLeave);
    window.addEventListener("blur", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerout", onLeave);
      window.removeEventListener("blur", onLeave);
    };
  }, [eventSource, stampAlong, startLoop]);

  const getRelativePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const windowMode = eventSource === "window";

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 1,
        cursor: windowMode ? "default" : "none",
        pointerEvents: windowMode ? "none" : "auto",
        ...style,
      }}
      onMouseEnter={
        windowMode
          ? undefined
          : (e) => {
              const pos = getRelativePos(e);
              lastPosRef.current = pos;
              stampAlong(pos.x, pos.y);
              startLoop();
            }
      }
      onMouseMove={
        windowMode
          ? undefined
          : (e) => {
              const pos = getRelativePos(e);
              stampAlong(pos.x, pos.y);
              startLoop();
            }
      }
      onMouseLeave={
        windowMode
          ? undefined
          : () => {
              lastPosRef.current = null;
            }
      }
    />
  );
}
