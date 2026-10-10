"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyMessage({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="panel p-5">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{text}</pre>
      <button type="button" className="btn btn-ink !py-2 !px-4 text-xs mt-4" onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); }}>
        {done ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy message</>}
      </button>
    </div>
  );
}
