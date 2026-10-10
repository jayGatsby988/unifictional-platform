"use client";
import * as React from "react";
import { useEffect, useRef } from "react";
import { createNoise2D } from "simplex-noise";

import { isConstrained } from "@/lib/perf";

interface Point {
  x: number;
  y: number;
  wx: number;
  wy: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
}

interface WavesProps {
  className?: string;
  strokeColor?: string;
  backgroundColor?: string;
  pointerSize?: number;
}

/**
 * Animated wave-line field (booking page background).
 *
 * Same lines, spacing, motion and cursor push as the original, but drawn on a
 * single <canvas> in one stroke per frame instead of rebuilding ~60–160 SVG
 * <path> strings (and re-laying-out the SVG) every frame — that loop was
 * pinning phones at 100% CPU while people tried to fill in the booking form.
 * Also: 1x resolution at ~24fps on phones / slow devices (the drift is slow,
 * it reads the same), a still frame for reduced-motion, pauses when the tab is
 * hidden, and
 * the cursor now tracks correctly after scrolling (the old version used page
 * coordinates on a fixed-position layer).
 */
export function Waves({
  className = "",
  strokeColor = "#ffffff",
  backgroundColor = "#000000",
  pointerSize = 0.5,
}: WavesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const noise = createNoise2D();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = isConstrained() || window.matchMedia("(max-width: 767px)").matches;
    // Phones / slow devices: paint at 1x and ~24fps. The cost here is almost
    // all rasterising the canvas, not the maths — at 2x a phone without GPU
    // canvas spent ~94% of its main thread on it, at 1x ~20%. These are faint
    // hairlines behind the booking card, so 1x reads the same.
    const frameInterval = lowPower ? 1000 / 24 : 0;
    const maxDpr = lowPower ? 1 : 2;

    const mouse = { x: -10, y: 0, lx: 0, ly: 0, sx: 0, sy: 0, vs: 0, a: 0, set: false };
    let lines: Point[][] = [];
    let width = 0;
    let height = 0;
    let raf = 0;
    let last = 0;

    const setup = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const xGap = 10;
      const yGap = 28;
      const oWidth = width + 200;
      const oHeight = height + 30;
      const totalLines = Math.ceil(oWidth / xGap);
      const totalPoints = Math.ceil(oHeight / yGap);
      const xStart = (width - xGap * totalLines) / 2;
      const yStart = (height - yGap * totalPoints) / 2;
      lines = [];
      for (let i = 0; i < totalLines; i++) {
        const pts: Point[] = [];
        for (let j = 0; j < totalPoints; j++) {
          pts.push({ x: xStart + xGap * i, y: yStart + yGap * j, wx: 0, wy: 0, cx: 0, cy: 0, vx: 0, vy: 0 });
        }
        lines.push(pts);
      }
    };

    const step = (time: number) => {
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      const dx = mouse.x - mouse.lx;
      const dy = mouse.y - mouse.ly;
      const d = Math.hypot(dx, dy);
      mouse.vs += (d - mouse.vs) * 0.1;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);
      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(calc(${mouse.sx}px - 50%), calc(${mouse.sy}px - 50%), 0)`;
      }

      const l = Math.max(175, mouse.vs);
      const push = l * mouse.vs * 0.00035;
      const ca = Math.cos(mouse.a);
      const sa = Math.sin(mouse.a);

      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (let li = 0; li < lines.length; li++) {
        const pts = lines[li];
        for (let pi = 0; pi < pts.length; pi++) {
          const p = pts[pi];
          const move = noise((p.x + time * 0.008) * 0.003, (p.y + time * 0.003) * 0.002) * 8;
          p.wx = Math.cos(move) * 12;
          p.wy = Math.sin(move) * 6;

          if (push > 0) {
            const ddx = p.x - mouse.sx;
            const ddy = p.y - mouse.sy;
            const dist = Math.hypot(ddx, ddy);
            if (dist < l) {
              const f = Math.cos(dist * 0.001) * (1 - dist / l);
              p.vx += ca * f * push;
              p.vy += sa * f * push;
            }
          }
          p.vx += (0 - p.cx) * 0.01;
          p.vy += (0 - p.cy) * 0.01;
          p.vx *= 0.95;
          p.vy *= 0.95;
          p.cx = Math.min(50, Math.max(-50, p.cx + p.vx));
          p.cy = Math.min(50, Math.max(-50, p.cy + p.vy));

          // First point of each line ignores the cursor (as before).
          const x = p.x + p.wx + (pi === 0 ? 0 : p.cx);
          const y = p.y + p.wy + (pi === 0 ? 0 : p.cy);
          if (pi === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.lineWidth = 1;
      ctx.strokeStyle = strokeColor;
      ctx.stroke();
    };

    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      if (frameInterval && time - last < frameInterval) return;
      last = time;
      step(time);
    };

    const onMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!mouse.set) {
        mouse.sx = mouse.lx = mouse.x;
        mouse.sy = mouse.ly = mouse.y;
        mouse.set = true;
      }
    };
    let resizeT: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(resizeT);
      resizeT = setTimeout(() => {
        setup();
        if (reduced) step(0);
      }, 120);
    };

    setup();
    if (reduced) {
      step(0);
    } else {
      window.addEventListener("mousemove", onMove, { passive: true });
      raf = requestAnimationFrame(tick);
    }
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeT);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
    };
  }, [strokeColor]);

  return (
    <div
      ref={containerRef}
      className={`waves-component relative overflow-hidden ${className}`}
      style={{ backgroundColor, width: "100%", height: "100%" }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <div
        ref={dotRef}
        className="pointer-dot"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: `${pointerSize}rem`,
          height: `${pointerSize}rem`,
          background: strokeColor,
          borderRadius: "50%",
          transform: "translate3d(calc(-0.5rem - 50%), calc(50vh - 50%), 0)",
          willChange: "transform",
        }}
      />
    </div>
  );
}
