"use client";

import { useState } from "react";
import { ArrowRight, Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { serviceOptions } from "@/lib/site";

type Status = "idle" | "submitting" | "success" | "error";

const inputCls =
  "w-full rounded-sm border border-line bg-paper px-4 py-3 text-base text-ink placeholder:text-ink-muted outline-none transition focus:border-terracotta focus:ring-1 focus:ring-terracotta/30 sm:text-sm";
const labelCls = "mb-1.5 block font-mono text-[11px] uppercase tracking-label text-ink-muted";

export function BookingForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (s: string) =>
    setSelected((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const payload = {
      name: String(fd.get("name") || "").trim(),
      businessName: String(fd.get("businessName") || "").trim(),
      phone: String(fd.get("phone") || "").trim(),
      email: String(fd.get("email") || "").trim(),
      website: String(fd.get("website") || "").trim(),
      services: selected,
      message: String(fd.get("message") || "").trim(),
    };
    if (!payload.name || !payload.email || !payload.phone) {
      setStatus("error");
      setErrorMsg("Please add your name, email, and phone so we can reach you.");
      return;
    }
    try {
      setStatus("submitting");
      setErrorMsg("");
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Request failed");
      setStatus("success");
      form.reset();
      setSelected([]);
    } catch {
      setStatus("error");
      setErrorMsg("Something went wrong sending your details. Please try again or call us.");
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-col items-start rounded-2xl border border-line bg-paper/75 p-8 shadow-[0_30px_60px_-30px_rgba(26,23,20,0.4)] backdrop-blur-xl">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-terracotta/10 ring-1 ring-terracotta/30">
          <Check className="h-6 w-6 text-terracotta" />
        </span>
        <h3 className="mt-5 font-display text-2xl font-medium text-ink">
          Got it — your details are in.
        </h3>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
          We&apos;ll reach out within one business day to set up your call and learn about your
          goals.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-6 font-sans text-sm text-terracotta underline-offset-4 hover:underline"
        >
          Send another request
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-line bg-paper/75 p-6 shadow-[0_30px_60px_-30px_rgba(26,23,20,0.4)] backdrop-blur-xl sm:p-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelCls}>
            Name *
          </label>
          <input id="name" name="name" autoComplete="name" required placeholder="Jane Contractor" className={inputCls} />
        </div>
        <div>
          <label htmlFor="businessName" className={labelCls}>
            Business
          </label>
          <input id="businessName" name="businessName" autoComplete="organization" placeholder="Blue Lake Construction" className={inputCls} />
        </div>
        <div>
          <label htmlFor="phone" className={labelCls}>
            Phone *
          </label>
          <input id="phone" name="phone" type="tel" autoComplete="tel" required placeholder="(555) 123-4567" className={inputCls} />
        </div>
        <div>
          <label htmlFor="email" className={labelCls}>
            Email *
          </label>
          <input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="website" className={labelCls}>
            Current website (optional)
          </label>
          <input id="website" name="website" type="url" inputMode="url" placeholder="https://…" className={inputCls} />
        </div>
      </div>

      <fieldset className="mt-6">
        <legend className={labelCls}>What are you interested in?</legend>
        <div className="flex flex-wrap gap-2">
          {serviceOptions.map((s) => {
            const on = selected.includes(s);
            return (
              <button
                type="button"
                key={s}
                onClick={() => toggle(s)}
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
        <label htmlFor="message" className={labelCls}>
          What do you want more of?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          placeholder="Tell us about your business and the kind of jobs you want more of…"
          className={cn(inputCls, "resize-none")}
        />
      </div>

      {status === "error" && (
        <p role="alert" className="mt-4 rounded-sm border border-terracotta/30 bg-terracotta/5 px-4 py-3 text-sm text-terracotta">
          {errorMsg}
        </p>
      )}

      <button
        type="submit"
        disabled={status === "submitting"}
        className="group mt-7 inline-flex w-full items-center justify-center gap-2 rounded-full bg-ink px-7 py-4 font-sans text-sm font-medium text-bone shadow-btn ring-1 ring-inset ring-bone/15 transition-transform duration-300 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 sm:w-auto"
      >
        {status === "submitting" ? "Sending…" : "Request my call"}
        <ArrowRight className="size-4 will-change-transform transition-transform duration-300 group-hover:translate-x-0.5" />
      </button>
      <p className="mt-3 text-[11px] text-ink-muted">
        By submitting, you agree to be contacted about your project. No spam.
      </p>
    </form>
  );
}
