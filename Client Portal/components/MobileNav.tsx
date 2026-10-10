"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";

export function MobileNav({ admin = false }: { admin?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button onClick={() => setOpen(true)} aria-label="Open menu" className="h-9 w-9 rounded-full border border-line grid place-items-center">
        <Menu className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-bone p-4">
          <div className="flex items-center justify-between mb-6">
            <span className="font-display text-lg">Menu</span>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="h-9 w-9 rounded-full border border-line grid place-items-center">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Sidebar admin={admin} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
