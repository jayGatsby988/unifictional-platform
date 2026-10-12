"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  Apple,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  Check,
  Clock,
  Download,
  Loader2,
  Mail,
  RefreshCw,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { serviceOptions } from "@/lib/site";

/* ------------------------------- types ---------------------------------- */
interface Slot {
  startISO: string;
  endISO: string;
  label: string;
}
interface DayAvailability {
  date: string;
  weekday: string;
  dayLabel: string;
  slots: Slot[];
}
interface AvailabilityResponse {
  timezone: string;
  durationMin: number;
  connected: boolean;
  from: string;
  days: DayAvailability[];
}
type CalendarChoice = "google" | "apple" | "outlook" | "ics";
type Step = "time" | "details" | "verify" | "done";

interface ConfirmResult {
  meeting: {
    title: string;
    startISO: string;
    endISO: string;
    durationMin: number;
    timezone: string;
    location: string;
  };
  links: { google: string; outlook: string; office365: string; yahoo: string };
  ics: string;
  calendarChoice: CalendarChoice;
  connected: boolean;
}

/* ------------------------------ styles ---------------------------------- */
const inputCls =
  "w-full rounded-sm border border-line bg-paper px-4 py-3 text-base text-ink placeholder:text-ink-muted outline-none transition focus:border-terracotta focus:ring-1 focus:ring-terracotta/30 sm:text-sm";
// text-base on phones: iOS Safari zooms the whole page into any field under 16px.
const labelCls = "mb-1.5 block font-mono text-[11px] uppercase tracking-label text-ink-muted";

const STEPS: { id: Step; label: string }[] = [
  { id: "time", label: "Time" },
  { id: "details", label: "Details" },
  { id: "verify", label: "Confirm" },
];

/** Sent to the API for the invite links; the done screen offers every option. */
const DEFAULT_CALENDAR: CalendarChoice = "google";

/** How long a half-finished booking survives a tab switch / accidental close. */
const PERSIST_TTL_MS = 15 * 60 * 1000;
const PERSIST_KEY = "unifictional-booking";

const CALENDAR_OPTIONS: {
  id: CalendarChoice;
  label: string;
  hint: string;
  icon: typeof CalendarDays;
}[] = [
  { id: "google", label: "Google Calendar", hint: "Opens Google in a new tab", icon: CalendarDays },
  { id: "apple", label: "Apple Calendar", hint: "Downloads an .ics invite", icon: Apple },
  { id: "outlook", label: "Outlook", hint: "Opens Outlook in a new tab", icon: CalendarPlus },
  { id: "ics", label: "Download .ics", hint: "Works with any calendar app", icon: Download },
];

/* ------------------------------ helpers --------------------------------- */
function downloadICS(ics: string) {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "unifictional-call.ics";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function applyCalendar(choice: CalendarChoice, result: ConfirmResult) {
  if (choice === "google") window.open(result.links.google, "_blank", "noopener");
  else if (choice === "outlook") window.open(result.links.outlook, "_blank", "noopener");
  else downloadICS(result.ics); // apple + ics
}

/* ----------------------------- component -------------------------------- */
export function BookingFlow() {
  const [step, setStep] = useState<Step>("time");

  // availability
  const [avail, setAvail] = useState<AvailabilityResponse | null>(null);
  const [availError, setAvailError] = useState(false);
  const [activeDate, setActiveDate] = useState<string>("");

  // selection + form
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({
    name: "",
    businessName: "",
    phone: "",
    email: "",
    hasWebsite: "" as "" | "yes" | "no",
    website: "",
    companyDetails: "",
    message: "",
  });
  const [services, setServices] = useState<string[]>([]);

  // verification
  const [token, setToken] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ConfirmResult | null>(null);

  // The visitor's timezone — set after mount so SSR HTML can't mismatch.
  const [localTz, setLocalTz] = useState("");
  useEffect(() => {
    try {
      setLocalTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    } catch {
      /* leave empty */
    }
  }, []);

  const topRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const hydratedRef = useRef(false);

  /* Make sure a new error is actually seen on a phone. */
  useEffect(() => {
    if (!error) return;
    const el = errorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 72 || r.bottom > window.innerHeight - 16) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [error]);

  /* Restore a half-finished booking (e.g. the visitor switched to their email
     app for the code and mobile Safari reloaded the page). */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PERSIST_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved?.savedAt || Date.now() - saved.savedAt > PERSIST_TTL_MS) {
        sessionStorage.removeItem(PERSIST_KEY);
        return;
      }
      if (saved.form) setForm((f) => ({ ...f, ...saved.form }));
      if (Array.isArray(saved.services)) setServices(saved.services);
      if (saved.slot) setSlot(saved.slot);
      if (saved.token) setToken(saved.token);
      if (saved.devCode) setDevCode(saved.devCode);
      if (saved.step === "details" || saved.step === "verify") setStep(saved.step);
    } catch {
      /* corrupted state — start fresh */
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  /* Keep the in-progress booking saved (cleared once booked). */
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (step === "done") sessionStorage.removeItem(PERSIST_KEY);
      else
        sessionStorage.setItem(
          PERSIST_KEY,
          JSON.stringify({ step, slot, form, services, token, devCode, savedAt: Date.now() })
        );
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [step, slot, form, services, token, devCode]);

  /* fetch availability once */
  useEffect(() => {
    let cancelled = false;
    fetch("/api/booking/availability?days=21")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: AvailabilityResponse) => {
        if (cancelled) return;
        setAvail(data);
        const firstOpen = data.days.find((d) => d.slots.length > 0);
        setActiveDate(firstOpen?.date ?? data.days[0]?.date ?? "");
      })
      .catch(() => !cancelled && setAvailError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const activeDay = useMemo(
    () => avail?.days.find((d) => d.date === activeDate) ?? null,
    [avail, activeDate]
  );

  function goto(next: Step) {
    setError("");
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const toggleService = (s: string) =>
    setServices((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  function selectSlot(s: Slot) {
    setSlot(s);
    goto("details");
  }

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return setError("Please add your name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim()))
      return setError("Please enter a valid email address.");
    if (!form.phone.trim()) return setError("Please add a phone number.");
    if (!form.hasWebsite) return setError("Let us know whether you have a website yet.");
    if (form.hasWebsite === "yes" && !form.website.trim())
      return setError("Paste the link to your current website.");
    if (form.hasWebsite === "no" && form.companyDetails.trim().length < 30)
      return setError("Tell us a little more about the company — a few sentences is perfect.");
    void startVerification();
  }

  async function startVerification() {
    if (!slot) return;
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/booking/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          website: form.hasWebsite === "yes" ? form.website : "",
          companyDetails: form.hasWebsite === "no" ? form.companyDetails : "",
          services,
          slotStartISO: slot.startISO,
          calendarChoice: DEFAULT_CALENDAR,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "Something went wrong. Please try again.");
        if (data.error === "slot_taken") goto("time");
        return;
      }
      setToken(data.token);
      setDevCode(data.devCode || "");
      setCode("");
      goto("verify");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function confirmBooking(e: React.FormEvent) {
    e.preventDefault();
    if (code.trim().length < 6) return setError("Enter the 6-digit code from your email.");
    setConfirming(true);
    setError("");
    try {
      const res = await fetch("/api/booking/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "We couldn't confirm your booking. Please try again.");
        if (data.error === "slot_taken") goto("time");
        return;
      }
      setResult(data as ConfirmResult);
      goto("done");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  const activeStepIndex = STEPS.findIndex((s) => s.id === step);

  /* ------------------------------ render -------------------------------- */
  return (
    <div
      ref={topRef}
      // Phones: a slightly more opaque card instead of a live backdrop blur —
      // blurring the animated waves behind it every frame was a big GPU cost
      // there, and the waves are faint enough that it reads the same.
      className="rounded-2xl border border-line bg-paper/[0.93] p-6 shadow-[0_30px_60px_-30px_rgba(26,23,20,0.4)] sm:bg-paper/75 sm:p-8 sm:backdrop-blur-xl"
    >
      {/* Stepper */}
      {step !== "done" && (
        <ol className="mb-7 flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i < activeStepIndex;
            const current = i === activeStepIndex;
            return (
              <li key={s.id} className="flex flex-1 items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition",
                    done && "border-terracotta bg-terracotta text-white",
                    current && "border-terracotta bg-terracotta/10 text-terracotta",
                    !done && !current && "border-line bg-paper text-ink-muted"
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span
                  className={cn(
                    "hidden text-xs font-medium sm:block",
                    current ? "text-ink" : "text-ink-muted"
                  )}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className={cn("ml-1 h-px flex-1", done ? "bg-terracotta" : "bg-line")} />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Selected slot summary */}
      {slot && step !== "done" && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-line bg-ink/[0.03] px-4 py-3">
          <CalendarDays className="h-4 w-4 shrink-0 text-terracotta" />
          <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-ink">
            <span className="whitespace-nowrap font-medium">{formatChosen(slot)}</span>
            <span className="whitespace-nowrap text-ink-muted">· {avail?.durationMin ?? 30} min</span>
          </p>
          {step !== "verify" && (
            <button
              type="button"
              onClick={() => goto("time")}
              className="ml-auto text-xs text-terracotta underline-offset-4 hover:underline"
            >
              Change
            </button>
          )}
        </div>
      )}

      {/* error banner — top of card on the time step (e.g. "slot taken"
          bounces back here); the form steps render it beside their button */}
      {error && step === "time" && <ErrorNote ref={errorRef}>{error}</ErrorNote>}

      {/* STEP: time */}
      {step === "time" && (
        <div key="time" className="animate-rise">
          <h3 className="font-display text-2xl font-medium text-ink">Pick a time that works.</h3>
          <p className="mt-1.5 text-sm text-ink-soft">
            All times are in your local time{localTz ? ` (${localTz.replace(/_/g, " ")})` : ""}.
          </p>

          {availError && (
            <p className="mt-6 rounded-sm border border-line bg-paper px-4 py-3 text-sm text-ink-soft">
              We couldn&apos;t load availability right now. Please refresh, or email{" "}
              <a href="mailto:Unifictional@gmail.com" className="text-terracotta underline underline-offset-4">
                Unifictional@gmail.com
              </a>
              .
            </p>
          )}

          {!avail && !availError && (
            // Placeholder the same shape as the loaded picker, so the page
            // doesn't jump (and push the column below) when times arrive.
            <div className="mt-6" role="status">
              <span className="sr-only">Loading open times…</span>
              <div aria-hidden className="flex gap-2 overflow-hidden pb-2">
                {Array.from({ length: 7 }, (_, i) => (
                  <div
                    key={i}
                    className="h-[62px] min-w-[62px] shrink-0 animate-pulse rounded-xl border border-line bg-paper"
                  />
                ))}
              </div>
              <div aria-hidden className="mt-6 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: 24 }, (_, i) => (
                  <div
                    key={i}
                    className="h-[42px] animate-pulse rounded-lg border border-line bg-paper"
                  />
                ))}
              </div>
            </div>
          )}

          {avail && (
            <>
              {/* day rail */}
              <div className="mt-6 flex gap-2 overflow-x-auto pb-2 [scrollbar-width:thin]">
                {avail.days.map((d) => {
                  const open = d.slots.length > 0;
                  const on = d.date === activeDate;
                  const [w, rest] = [d.weekday, d.dayLabel.replace(`${d.weekday}, `, "")];
                  return (
                    <button
                      key={d.date}
                      type="button"
                      disabled={!open}
                      onClick={() => setActiveDate(d.date)}
                      className={cn(
                        "flex min-w-[62px] flex-col items-center rounded-xl border px-3 py-2.5 text-center transition",
                        on
                          ? "border-terracotta bg-terracotta/10"
                          : open
                            ? "border-line bg-paper hover:border-ink/30"
                            : "cursor-not-allowed border-line/60 bg-paper/40 opacity-40"
                      )}
                    >
                      <span
                        className={cn(
                          "text-[11px] uppercase tracking-wide",
                          on ? "text-terracotta" : "text-ink-muted"
                        )}
                      >
                        {w}
                      </span>
                      <span className={cn("mt-0.5 whitespace-nowrap text-sm font-medium", on ? "text-terracotta" : "text-ink")}>
                        {rest}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* slots */}
              <div className="mt-6">
                {activeDay && activeDay.slots.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {activeDay.slots.map((s) => (
                      <button
                        key={s.startISO}
                        type="button"
                        onClick={() => selectSlot(s)}
                        className="rounded-lg border border-line bg-paper px-2 py-2.5 text-sm text-ink transition hover:border-terracotta hover:bg-terracotta/5 hover:text-terracotta"
                      >
                        {localTimeLabel(s.startISO)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-sm border border-line bg-paper px-4 py-6 text-center text-sm text-ink-muted">
                    No open times this day — try another.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* STEP: details */}
      {step === "details" && (
        <form key="details" onSubmit={submitDetails} noValidate className="animate-rise">
          <h3 className="font-display text-2xl font-medium text-ink">Tell us about you.</h3>
          <p className="mt-1.5 text-sm text-ink-soft">
            This is what we build your new website from. It will be ready before the call.
          </p>

          <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Name *">
              <input
                className={inputCls}
                autoComplete="name"
                placeholder="Jane Contractor"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Business">
              <input
                className={inputCls}
                autoComplete="organization"
                placeholder="Blue Lake Construction"
                value={form.businessName}
                onChange={(e) => setForm({ ...form, businessName: e.target.value })}
              />
            </Field>
            <Field label="Phone *">
              <input
                className={inputCls}
                type="tel"
                autoComplete="tel"
                placeholder="(555) 123-4567"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </Field>
            <Field label="Email *">
              <input
                className={inputCls}
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <div className="sm:col-span-2">
              <span className={labelCls}>Do you have a website? *</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Do you have a website?">
                {(
                  [
                    ["yes", "Yes, here's the link"],
                    ["no", "Not yet"],
                  ] as const
                ).map(([value, label]) => {
                  const on = form.hasWebsite === value;
                  return (
                    <button
                      type="button"
                      key={value}
                      role="radio"
                      aria-checked={on}
                      onClick={() => setForm({ ...form, hasWebsite: value })}
                      className={cn(
                        "rounded-full border px-4 py-2 text-sm backdrop-blur-sm transition",
                        on
                          ? "border-terracotta bg-terracotta/15 text-terracotta shadow-glass-soft"
                          : "border-line bg-ink/[0.03] text-ink-soft hover:border-ink/30 hover:bg-ink/[0.06]"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            {form.hasWebsite === "yes" && (
              <div className="animate-rise sm:col-span-2">
                <Field label="Current website *">
                  <input
                    className={inputCls}
                    type="url"
                    inputMode="url"
                    autoFocus
                    placeholder="https://yourcompany.com"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                  />
                </Field>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                  We read every page, your photos and your reviews, then build the new version of
                  your site before we meet. You see it live on the call.
                </p>
              </div>
            )}
            {form.hasWebsite === "no" && (
              <div className="animate-rise sm:col-span-2">
                <Field label="Tell us about the company *">
                  <textarea
                    rows={5}
                    autoFocus
                    className={cn(inputCls, "resize-none")}
                    placeholder="What you do, where you work, the services you offer, how long you've been at it, and what makes you different. A few sentences is perfect."
                    value={form.companyDetails}
                    onChange={(e) => setForm({ ...form, companyDetails: e.target.value })}
                  />
                </Field>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                  No website is fine. We research your company from this and build your site
                  before the call.
                </p>
              </div>
            )}
          </div>

          <fieldset className="mt-6">
            <legend className={labelCls}>What are you interested in?</legend>
            <div className="flex flex-wrap gap-2">
              {serviceOptions.map((s) => {
                const on = services.includes(s);
                return (
                  <button
                    type="button"
                    key={s}
                    onClick={() => toggleService(s)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-3.5 py-1.5 text-xs backdrop-blur-sm transition",
                      on
                        ? "border-terracotta bg-terracotta/15 text-terracotta shadow-glass-soft"
                        : "border-line bg-ink/[0.03] text-ink-soft hover:border-ink/30 hover:bg-ink/[0.06]"
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-6">
            <Field label="What do you want more of?">
              <textarea
                rows={3}
                className={cn(inputCls, "resize-none")}
                placeholder="Tell us about your business and the jobs you want more of…"
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </Field>
          </div>

          {error && (
            <ErrorNote ref={errorRef} className="mb-0 mt-6">
              {error}
            </ErrorNote>
          )}

          <StepNav
            onBack={() => goto("time")}
            nextLabel={sending ? "Sending code…" : "Continue"}
            nextDisabled={sending}
            loading={sending}
          />
        </form>
      )}

      {/* STEP: verify */}
      {step === "verify" && (
        <form key="verify" onSubmit={confirmBooking} className="animate-rise">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-terracotta/10 ring-1 ring-terracotta/30">
            <Mail className="h-5 w-5 text-terracotta" />
          </span>
          <h3 className="mt-5 font-display text-2xl font-medium text-ink">Check your email.</h3>
          <p className="mt-1.5 max-w-md text-sm text-ink-soft">
            We sent a 6-digit code to <span className="font-medium text-ink">{form.email}</span>. Enter it
            below to lock in your call.
          </p>

          {devCode && (
            <p className="mt-4 rounded-sm border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-700">
              Dev mode (no email provider connected): your code is{" "}
              <span className="font-mono font-semibold">{devCode}</span>
            </p>
          )}

          <div className="mt-6 max-w-[260px]">
            <Field label="Verification code">
              <input
                className={cn(inputCls, "text-center text-lg tracking-[0.5em]")}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </Field>
          </div>

          <button
            type="button"
            onClick={startVerification}
            disabled={sending}
            className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-muted transition hover:text-terracotta disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", sending && "animate-spin")} /> Resend code
          </button>

          {error && (
            <ErrorNote ref={errorRef} className="mb-0 mt-5">
              {error}
            </ErrorNote>
          )}

          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => goto("details")}
              className="inline-flex items-center justify-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </button>
            <button
              type="submit"
              disabled={confirming || code.length < 6}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-7 py-3.5 font-sans text-sm font-medium text-bone shadow-btn ring-1 ring-inset ring-bone/15 transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 sm:ml-auto"
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Confirming…
                </>
              ) : (
                <>
                  Confirm booking
                  <Check className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* STEP: done */}
      {step === "done" && result && (
        <div key="done" className="animate-rise text-center sm:text-left">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10 ring-1 ring-terracotta/30">
            <Check className="h-6 w-6 text-terracotta" />
          </span>
          <h3 className="mt-5 font-display text-3xl font-medium text-ink">You&apos;re booked in.</h3>
          <p className="mt-2 text-sm text-ink-soft">
            A confirmation is on its way to{" "}
            <span className="font-medium text-ink">{form.email}</span>. We&apos;re starting on your
            website now.
          </p>

          <div className="mt-6 rounded-xl border border-terracotta/30 bg-terracotta/5 p-5 text-left">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-terracotta">
              Before the call
            </p>
            <ol className="mt-3 space-y-2.5 text-sm leading-relaxed text-ink-soft">
              <li className="flex gap-3">
                <span className="font-mono text-xs text-ink-muted">01</span>
                <span>
                  We research {form.businessName.trim() || "your business"}: your services, your
                  projects, your reviews, your market.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-ink-muted">02</span>
                <span>
                  We build your new website. Every page written, your photos and logo, search
                  optimisation done.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="font-mono text-xs text-ink-muted">03</span>
                <span>On the call we walk through it together. Then you decide.</span>
              </li>
            </ol>
          </div>

          <div className="mt-6 rounded-xl border border-line bg-ink/[0.03] p-5 text-left">
            <Row icon={CalendarDays} label="When">
              {formatChosen(
                { startISO: result.meeting.startISO, endISO: result.meeting.endISO, label: "" },
                true
              )}
            </Row>
            <Row icon={Clock} label="Length">
              {result.meeting.durationMin} minutes
            </Row>
            <Row icon={Mail} label="With">
              Unifictional
            </Row>
          </div>

          {/* primary add-to-calendar = their chosen option */}
          <div className="mt-6">
            <p className={labelCls}>Add to your calendar</p>
            <button
              type="button"
              onClick={() => applyCalendar(result.calendarChoice, result)}
              className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-7 py-3.5 font-sans text-sm font-medium text-bone shadow-btn ring-1 ring-inset ring-bone/15 transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] sm:w-auto"
            >
              {chosenLabel(result.calendarChoice)}
              <ArrowRight className="h-4 w-4 will-change-transform transition-transform group-hover:translate-x-0.5" />
            </button>

            {/* other options */}
            <div className="mt-3 flex flex-wrap gap-2">
              {CALENDAR_OPTIONS.filter((o) => o.id !== result.calendarChoice).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => applyCalendar(o.id, result)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-1.5 text-xs text-ink-soft transition hover:border-ink/30 hover:text-ink"
                >
                  <o.icon className="h-3.5 w-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------- small helpers ------------------------------ */
const ErrorNote = forwardRef<HTMLParagraphElement, { children: React.ReactNode; className?: string }>(
  function ErrorNote({ children, className }, ref) {
    return (
      <p
        ref={ref}
        role="alert"
        className={cn(
          "mb-5 scroll-mt-24 rounded-sm border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-sm text-terracotta",
          className
        )}
      >
        {children}
      </p>
    );
  }
);
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {children}
    </label>
  );
}

function StepNav({
  onBack,
  onNext,
  nextLabel,
  nextDisabled,
  loading,
}: {
  onBack: () => void;
  onNext?: () => void;
  nextLabel: string;
  nextDisabled?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center justify-center gap-1.5 text-sm text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <button
        type={onNext ? "button" : "submit"}
        onClick={onNext}
        disabled={nextDisabled}
        className="group inline-flex items-center justify-center gap-2 rounded-full bg-ink px-7 py-3.5 font-sans text-sm font-medium text-bone shadow-btn ring-1 ring-inset ring-bone/15 transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 sm:ml-auto"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {nextLabel}
        {!loading && <ArrowRight className="h-4 w-4 will-change-transform transition-transform group-hover:translate-x-0.5" />}
      </button>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CalendarDays;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-terracotta" />
      <span className="text-[11px] uppercase tracking-label text-ink-muted">{label}</span>
      <span className="ml-auto text-right text-sm font-medium text-ink">{children}</span>
    </div>
  );
}

function chosenLabel(choice: CalendarChoice) {
  if (choice === "google") return "Add to Google Calendar";
  if (choice === "outlook") return "Add to Outlook";
  if (choice === "apple") return "Download Apple invite";
  return "Download .ics file";
}

/** A slot's start time in the VISITOR's timezone (labels from the server are
 *  in the studio's timezone, which reads as 3 hours off to a Pacific buyer). */
function localTimeLabel(startISO: string) {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
    new Date(startISO)
  );
}

function formatChosen(
  slot: { startISO: string; endISO: string; label: string },
  withYear?: boolean
) {
  const d = new Date(slot.startISO);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    ...(withYear ? { timeZoneName: "short" } : {}),
  }).format(d);
}
