"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Menu, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { SignOut, StudioContact } from "./AccountLinks";

export function MobileNav({ admin = false, services, showNav = true, contact }: {
  admin?: boolean; services?: string[]; showNav?: boolean; contact?: { name: string; email: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open} className="h-11 w-11 rounded-full border border-line grid place-items-center">
        <Menu className="h-5 w-5" />
      </button>
      {/* Portaled to <body>: the header uses backdrop-blur, which would trap a fixed panel inside its 64px. */}
      {open && createPortal(
        <div className="fixed inset-0 z-50 bg-bone p-4 overflow-y-auto flex flex-col" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center justify-between mb-6">
            <span className="font-display text-lg">Menu</span>
            <button onClick={() => setOpen(false)} aria-label="Close menu" className="h-11 w-11 rounded-full border border-line grid place-items-center">
              <X className="h-5 w-5" />
            </button>
          </div>
          {showNav && <Sidebar admin={admin} services={services} onNavigate={() => setOpen(false)} />}
          <div className="mt-auto pt-8 space-y-4">
            {contact && <StudioContact {...contact} />}
            <SignOut />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
