"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { Demo } from "@/lib/walkthroughs";
import VOICE from "@/lib/voice-manifest.json";
import { SCREENS, SCREEN_URL } from "./screens";
import { cn } from "@/lib/utils";

const W = 960, H = 560, BAR = 44;
type Box = { x: number; y: number; w: number; h: number };

/**
 * Animated, captioned walkthrough. A cursor glides to each button, a ring
 * pulses around it, text types itself in, and a big caption says what to do.
 * Plays when scrolled into view; Slower and Read aloud are one tap away.
 */
const MANIFEST = VOICE as Record<string, Record<string, number>>;

/** Point the shared audio element at a clip and play it (also used to unlock audio inside a tap on iOS). */
function startClip(ref: { current: HTMLAudioElement | null }, url: string, rate = 1) {
  const a = ref.current ?? new Audio();
  ref.current = a;
  a.src = url;
  a.playbackRate = rate;
  a.currentTime = 0;
  a.play().catch(() => {});
  return a;
}

/** Best-sounding system voice, used only if a recorded clip is missing. */
function pickVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const vs = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  const pref = [/natural/i, /neural/i, /premium/i, /enhanced/i, /samantha/i, /google us english/i, /aria|jenny|guy/i, /daniel|karen|moira/i];
  for (const re of pref) { const v = vs.find((x) => re.test(x.name)); if (v) return v; }
  return vs[0] ?? null;
}

export function Walkthrough({ demo, slug, goto, onStep }: { demo: Demo; slug?: string; goto?: { i: number; n: number }; onStep?: (i: number) => void }) {
  const steps = demo.steps;
  const last = steps.length - 1;
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [voice, setVoice] = useState(false);
  const [cursor, setCursor] = useState({ x: W * 0.62, y: H * 0.7 });
  const [box, setBox] = useState<Box | null>(null);
  const [clicks, setClicks] = useState(0);
  const [typed, setTyped] = useState("");
  const [cw, setCw] = useState(640);
  const [ended, setEnded] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const seen = useRef(false);
  const step = steps[i];
  const f = slow ? 1.6 : 1;
  const clipMs = slug ? MANIFEST[slug]?.[String(i)] : undefined;
  const audio = useRef<HTMLAudioElement | null>(null);

  // Fit the fixed 960×560 stage to the available width.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Start playing the first time it scrolls into view.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !seen.current) { seen.current = true; setPlaying(true); }
    }, { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Jump requests from the written steps.
  useEffect(() => {
    if (!goto) return;
    const t = setTimeout(() => { setI(Math.max(0, Math.min(last, goto.i))); setPlaying(false); setEnded(false); }, 0);
    return () => clearTimeout(t);
  }, [goto, last]);

  useEffect(() => { onStep?.(i); }, [i, onStep]);

  // Animate the current step.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let typer: ReturnType<typeof setInterval> | undefined;
    const raf = requestAnimationFrame(() => {
      setTyped("");
      const s = stage.current;
      const el = s?.querySelector<HTMLElement>(`[data-t="${step.target}"]`);
      if (s && el) {
        const a = s.getBoundingClientRect(), b = el.getBoundingClientRect();
        const k = a.width / W || 1;
        const r = { x: (b.left - a.left) / k, y: (b.top - a.top) / k, w: b.width / k, h: b.height / k };
        setBox(r);
        setCursor({ x: r.x + Math.min(r.w * 0.5, r.w - 6), y: r.y + r.h * 0.6 });
      } else setBox(null);
    });
    const arrive = 650 * f;
    if (step.action === "click") timers.push(setTimeout(() => setClicks((c) => c + 1), arrive));
    if (step.action === "type" && step.type) {
      const text = step.type;
      timers.push(setTimeout(() => {
        let n = 0;
        typer = setInterval(() => { n += 1; setTyped(text.slice(0, n)); if (n >= text.length && typer) clearInterval(typer); }, 45 * f);
      }, arrive));
    }
    if (playing) {
      const typing = (step.type?.length ?? 0) * 45 + (step.type ? 650 : 0);
      // With the voice on, wait for the recording (plus a short beat); otherwise a reading-time estimate.
      const spoken = voice && clipMs ? clipMs / (slow ? 0.9 : 1) + 450 : 0;
      const reading = (700 + step.caption.length * 42) * f;
      const hold = Math.max(2400 * f, spoken, reading, typing * f + 900);
      timers.push(setTimeout(() => {
        if (i < last) setI(i + 1);
        else { setPlaying(false); setEnded(true); }
      }, hold));
    }
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); if (typer) clearInterval(typer); };
  }, [i, playing, f, step, last, voice, clipMs, slow]);

  // Voiceover: the recorded clip for this step, or the best system voice if there isn't one.
  useEffect(() => {
    if (!voice || typeof window === "undefined") return;
    if (slug && clipMs) {
      const a = startClip(audio, `/voice/${slug}/${i}.mp3`, slow ? 0.9 : 1);
      if (i < last && MANIFEST[slug]?.[String(i + 1)]) { const pre = new Audio(); pre.preload = "auto"; pre.src = `/voice/${slug}/${i + 1}.mp3`; }
      return () => { a.pause(); };
    }
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance((step.say ?? step.caption).replace(/“|”/g, ""));
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = slow ? 0.85 : 1;
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }, [i, voice, slow, slug, clipMs, last, step.caption, step.say]);

  // Camera: on narrow screens zoom in ~2× and pan to keep the cursor centred,
  // so the button being pressed is always big enough to read.
  const phone = cw < 640;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const base = cw / W;
  // Zoom so the whole target fits with a margin, between 1× and 2.1× of "fit the page".
  const scale = phone ? clamp((cw - 40) / ((box?.w ?? 240) + 24), base, base * 2.1) : base;
  const viewH = phone ? Math.round(cw * 0.82) : Math.round(H * scale);
  const fx = box ? box.x + box.w / 2 : cursor.x, fy = box ? box.y + box.h / 2 : cursor.y;
  const tx = phone ? clamp(cw / 2 - fx * scale, cw - W * scale, 0) : 0;
  const ty = phone ? clamp(viewH / 2 - fy * scale, viewH - H * scale, 0) : 0;

  const values: Record<string, string> = { ...(step.fill ?? {}), ...(step.action === "type" ? { [step.target]: typed } : {}) };
  const Screen = SCREENS[step.screen];
  const url = step.url ?? SCREEN_URL[step.screen] ?? "";
  const go = (n: number) => { setEnded(false); setI(Math.max(0, Math.min(last, n))); };

  return (
    <div className="rounded-3xl border border-line bg-paper/60 p-3 sm:p-4">
      <div ref={wrap} className="relative w-full overflow-hidden rounded-2xl shadow-[0_30px_60px_-30px_rgba(0,0,0,.45)]" style={{ height: viewH }} aria-hidden>
        <div ref={stage} className="absolute left-0 top-0 bg-white" style={{ width: W, height: H, transform: `translate(${tx}px, ${ty}px) scale(${scale})`, transformOrigin: "0 0", transition: phone ? `transform ${620 * f}ms cubic-bezier(.25,.8,.25,1)` : undefined }}>
          <div className="absolute inset-x-0 top-0 flex items-center gap-3 px-4 bg-[#ececec] border-b border-[#d6d6d6]" style={{ height: BAR }}>
            <span className="flex gap-1.5"><span className="h-3 w-3 rounded-full bg-[#ff5f57]" /><span className="h-3 w-3 rounded-full bg-[#febc2e]" /><span className="h-3 w-3 rounded-full bg-[#28c840]" /></span>
            <span data-t="url" className="mx-auto flex items-center gap-2 h-7 w-[520px] rounded-md bg-white px-3 text-[13px] text-[#444]"><Lock className="h-3.5 w-3.5 text-[#777]" />{url}</span>
          </div>
          <div key={step.screen} className="absolute inset-x-0 bottom-0 wt-fade" style={{ top: BAR }}>
            {Screen ? <Screen v={(k) => values[k] ?? ""} on={(k) => (step.on ?? []).includes(k)} active={step.action === "type" ? step.target : ""} /> : null}
          </div>
          {box && <div key={`box-${i}`} className="wt-ring" style={{ left: box.x - 8, top: box.y - 8, width: box.w + 16, height: box.h + 16 }} />}
          {clicks > 0 && step.action === "click" && <span key={`c-${clicks}`} className="wt-ripple" style={{ left: cursor.x, top: cursor.y }} />}
          <svg className="wt-cursor" style={{ transform: `translate(${cursor.x - 4}px, ${cursor.y - 2}px)`, transitionDuration: `${620 * f}ms` }} width="34" height="40" viewBox="0 0 24 28">
            <path d="M3 2 L3 22 L8.5 17 L12 25.5 L15.5 24 L12 15.8 L19.5 15.5 Z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
          </svg>
        </div>
        {ended && (
          <button type="button" onClick={() => { go(0); setPlaying(true); }} className="absolute inset-0 grid place-items-center bg-black/45 text-white">
            <span className="flex items-center gap-3 rounded-full bg-white text-ink px-6 py-3 text-lg font-medium"><RotateCcw className="h-5 w-5" /> Watch again</span>
          </button>
        )}
      </div>

      <div className="mt-4 sm:mt-5 px-1 sm:px-2" aria-live="polite">
        <p className="label mb-2">Step {i + 1} of {steps.length}</p>
        <p className="text-xl sm:text-2xl leading-snug min-h-[3.5em] sm:min-h-[2.6em]">{step.caption}</p>
      </div>

      <div className="mt-3 flex gap-1 px-1 sm:px-2" role="tablist" aria-label="Steps">
        {steps.map((_, n) => (
          <button key={n} type="button" aria-label={`Go to step ${n + 1}`} onClick={() => go(n)} className="flex-1 h-8 grid items-center">
            <span className={cn("block h-2 rounded-full transition-colors", n < i ? "bg-ink" : n === i ? "bg-ink/70" : "bg-line")} />
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 px-1 sm:px-2 pb-1">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} className="wt-btn" aria-label="Previous step"><ChevronLeft className="h-5 w-5" /> Back</button>
        <button type="button" onClick={() => { if (ended) { go(0); setPlaying(true); } else setPlaying(!playing); }} className="wt-btn wt-btn-primary" aria-label={playing ? "Pause" : "Play"}>
          {playing ? <><Pause className="h-5 w-5" /> Pause</> : <><Play className="h-5 w-5" /> {ended ? "Watch again" : "Play"}</>}
        </button>
        <button type="button" onClick={() => go(i + 1)} disabled={i === last} className="wt-btn" aria-label="Next step">Next <ChevronRight className="h-5 w-5" /></button>
        <span className="flex-1" />
        <button type="button" onClick={() => setSlow(!slow)} className={cn("wt-btn", slow && "wt-btn-on")} aria-pressed={slow}>{slow ? "Slower: on" : "Slower"}</button>
        <button type="button" onClick={() => {
          const on = !voice;
          // iPhone Safari only allows sound that starts inside the tap itself, so unlock the player here.
          if (on && slug && clipMs) startClip(audio, `/voice/${slug}/${i}.mp3`);
          if (!on) { audio.current?.pause(); if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }
          setVoice(on); if (on) { setEnded(false); setPlaying(true); }
        }} className={cn("wt-btn", voice && "wt-btn-on")} aria-pressed={voice}>{voice ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />} {voice ? "Voice on" : "Turn on voice"}</button>
      </div>
      <p className="mt-2 px-1 sm:px-2 text-xs text-ink-muted">Illustration. Your screen may look slightly different, but the buttons are in the same places.</p>
    </div>
  );
}
